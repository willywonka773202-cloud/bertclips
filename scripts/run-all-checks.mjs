#!/usr/bin/env node
/**
 * Run the entire scripts/check-*.mjs suite as one command.
 *
 * Discovers every scripts/check-*.mjs on disk, runs each as a child process
 * with the correct node flags, captures pass/fail plus duration, prints a
 * summary table, and exits non-zero if any check failed.
 *
 * Flag auto-detection: a check needs `--experimental-strip-types` when its
 * source imports a TypeScript module (a `.ts` specifier, static or dynamic)
 * or uses TypeScript-only syntax. The flag is a harmless no-op for plain
 * JavaScript, so over-detecting is safe while under-detecting would break a
 * TS-importing check; detection therefore errs toward enabling the flag.
 *
 * Dependency-free: node:fs, node:child_process, node:path only.
 */

import { spawn } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const SCRIPTS_DIR = path.resolve("scripts");

// Limit how many checks run at once. Series-like by default (small pool) to
// keep output and resource use predictable; override with CHECK_CONCURRENCY.
const CONCURRENCY = (() => {
  const raw = Number.parseInt(process.env.CHECK_CONCURRENCY ?? "", 10);
  if (Number.isFinite(raw) && raw > 0) return raw;
  return 4;
})();

/** True when the source needs `--experimental-strip-types` to run. */
function needsStripTypes(source) {
  // A TypeScript module specifier in an import/export/dynamic-import.
  if (/\.ts['"]/.test(source)) return true;
  // TypeScript-only syntax that plain node cannot parse.
  if (/^\s*(?:export\s+)?(?:interface|type)\s+\w/m.test(source)) return true;
  if (/\bas\s+const\b/.test(source)) return true;
  if (/\bsatisfies\s+\w/.test(source)) return true;
  if (/:\s*(?:string|number|boolean|unknown|any|void|never)\b/.test(source)) return true;
  return false;
}

function discoverChecks() {
  const all = readdirSync(SCRIPTS_DIR);
  const names = new Set(all);
  return all
    .filter((name) => name.startsWith("check-") && name.endsWith(".mjs"))
    // Exclude any check-X.mjs that has a sibling check-X.mjs.test.mjs: the plain
    // .mjs is the implementation (often a live probe that spawns processes, not
    // a pure assertion), and the paired .mjs.test.mjs is its actual test. Run
    // the test (it still matches check-*.mjs), skip the impl it covers.
    .filter((name) => !names.has(`${name}.test.mjs`))
    .sort()
    .map((name) => {
      const file = path.join(SCRIPTS_DIR, name);
      let stripTypes = false;
      try {
        stripTypes = needsStripTypes(readFileSync(file, "utf8"));
      } catch {
        // If the file cannot be read, run it plain and let the child surface it.
        stripTypes = false;
      }
      return { name, file, stripTypes };
    });
}

function runCheck(check) {
  return new Promise((resolve) => {
    const args = check.stripTypes
      ? ["--experimental-strip-types", check.file]
      : [check.file];
    const startedAt = Date.now();
    const child = spawn(process.execPath, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    child.on("error", (error) => {
      resolve({
        ...check,
        ok: false,
        code: null,
        durationMs: Date.now() - startedAt,
        stdout,
        stderr: `${stderr}\nFailed to spawn: ${error.message}`,
      });
    });

    child.on("close", (code) => {
      resolve({
        ...check,
        ok: code === 0,
        code,
        durationMs: Date.now() - startedAt,
        stdout,
        stderr,
      });
    });
  });
}

async function runWithConcurrency(checks, limit) {
  const results = new Array(checks.length);
  let next = 0;
  async function worker() {
    while (next < checks.length) {
      const index = next++;
      const check = checks[index];
      process.stdout.write(`  running ${check.name}\n`);
      results[index] = await runCheck(check);
    }
  }
  const workers = [];
  for (let i = 0; i < Math.min(limit, checks.length); i++) {
    workers.push(worker());
  }
  await Promise.all(workers);
  return results;
}

function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function printSummary(results) {
  const failed = results.filter((r) => !r.ok);

  // Surface output from failures so CI logs explain the break.
  for (const r of failed) {
    console.log("");
    console.log(`----- FAILED: ${r.name} (exit ${r.code === null ? "spawn-error" : r.code}) -----`);
    const out = `${r.stdout}${r.stderr}`.trimEnd();
    if (out) console.log(out);
  }

  const nameWidth = Math.max(4, ...results.map((r) => r.name.length));
  console.log("");
  console.log(`${"NAME".padEnd(nameWidth)}  STATUS  TIME`);
  console.log(`${"-".repeat(nameWidth)}  ------  ----`);
  for (const r of results) {
    const status = r.ok ? "pass" : "FAIL";
    console.log(`${r.name.padEnd(nameWidth)}  ${status.padEnd(6)}  ${formatDuration(r.durationMs)}`);
  }

  const totalMs = results.reduce((sum, r) => sum + r.durationMs, 0);
  console.log("");
  console.log(
    `${results.length} checks, ${results.length - failed.length} passed, ${failed.length} failed in ${formatDuration(totalMs)}`,
  );
}

async function main() {
  const checks = discoverChecks();
  if (checks.length === 0) {
    console.error("No scripts/check-*.mjs files found.");
    return 1;
  }
  console.log(`Discovered ${checks.length} checks (concurrency ${CONCURRENCY}).`);
  const results = await runWithConcurrency(checks, CONCURRENCY);
  printSummary(results);
  return results.some((r) => !r.ok) ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
