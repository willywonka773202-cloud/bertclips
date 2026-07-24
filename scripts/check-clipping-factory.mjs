import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * Safety guard for the live clip-factory bridge (lib/clipping/factory-bridge.ts +
 * the tick + the control route). The factory holds the real upload-post credential
 * and drives REAL public posts, so the bridge's invariants must never regress:
 *
 *  1. Server-only + loopback-only. The bridge talks to 127.0.0.1 only, never the
 *     public internet, and never runs on the cloud edge (deploymentMode gate).
 *  2. The credential never crosses. The bridge consumes only the factory's redacted
 *     surfaces — it never reads, forwards, or logs the upload-post API key.
 *  3. Control is access-gated. The POST route refuses the public edge when the gate
 *     is inactive; GET (read-only status) is safe.
 *  4. The heartbeat tick is READ-ONLY — it observes + publishes to the AI bus, and
 *     never triggers a post / arm / mark.
 *  5. The client panel never imports the server-only bridge (no bundle leak).
 */

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(here, "..", p), "utf8");

// ── 1. Bridge is server-only + loopback-only + edge-gated ───────────────────
const bridge = read("lib/clipping/factory-bridge.ts");
assert.match(bridge, /server-only/, "the bridge is server-only");
assert.match(bridge, /127\.0\.0\.1/, "the bridge defaults to the loopback host");
assert.doesNotMatch(bridge, /https:\/\//, "the bridge contains no https (public-internet) URL");
assert.match(bridge, /deploymentMode\(\)\s*===\s*["']local["']/, "the bridge is reachable only in local mode");
assert.match(bridge, /factoryConfigured/, "the bridge gates every call on factoryConfigured()");
// The loopback constraint is enforced at RUNTIME, not merely via the source literal:
// the resolved base URL is validated against a loopback allow-list over http, so a
// tampered BERTCLIPS_HUB_URL cannot steer a request off-box (SSRF).
assert.match(bridge, /resolveHubUrl/, "the bridge resolves the hub URL through a validator");
assert.match(bridge, /LOOPBACK_HOSTS/, "the bridge defines a loopback allow-list");
assert.match(bridge, /\.hostname\b/, "the bridge validates the resolved URL hostname");
assert.match(bridge, /protocol\s*===\s*["']http:["']/, "the bridge restricts the factory URL to the http protocol");

// ── 2. The upload-post credential never crosses the bridge ──────────────────
assert.doesNotMatch(bridge, /uploadPostApiKey/, "the bridge never references the upload-post key field");
assert.doesNotMatch(bridge, /settings\.keys|cfg\.settings|Apikey|apiKey/, "the bridge never handles a credential");
// It must not consume the factory's key-bearing analytics passthrough — only the
// operational, already-redacted endpoints.
assert.doesNotMatch(bridge, /\/api\/analytics-summary/, "the bridge does not proxy the key-scoped analytics endpoint");

// ── 3. The control route is access-gated (POST), read-only GET ──────────────
const route = read("app/api/clipping/factory/route.ts");
assert.match(route, /export async function GET/, "the factory route exposes a read-only GET");
assert.match(route, /export async function POST/, "the factory route exposes POST for control");
// Text presence is not enough — the gate check must RETURN immediately so control
// can never fall through to a factory action on the public edge.
assert.match(
  route,
  /if\s*\(\s*publicEdgeGateInactive\([^)]*\)\s*\)\s*\{\s*return\b/,
  "the POST returns immediately when the public edge gate is inactive (no fall-through)",
);
assert.match(route, /access_gate_required/, "the gate refusal returns the standard error code");

// ── 4. The heartbeat tick is READ-ONLY ──────────────────────────────────────
const tick = read("lib/clipping/factory-tick.ts");
assert.match(tick, /server-only/, "the factory tick is server-only");
assert.match(tick, /publishAiEvent/, "the tick publishes to the AI bus");
assert.doesNotMatch(
  tick,
  /\b(runFactoryTask|setFactoryArmed|markFactorySubmitted)\b/,
  "the tick must never trigger a post / arm / mark — it only observes",
);

// ── 4b. The READ path + its autonomous consumers never trigger control ──────
// readFactoryStatus()/buildStatus() (what the heartbeat research loop + the snapshot
// consume) must be side-effect-free, and the autonomous consumers must not call a
// control fn — so an autonomous read can never post / arm / mark.
const readPath = bridge.slice(bridge.indexOf("async function buildStatus"), bridge.indexOf("const VALID_TASKS"));
assert.ok(readPath.length > 0, "the bridge read path (buildStatus/readFactoryStatus) is locatable");
assert.doesNotMatch(
  readPath,
  /\b(runFactoryTask|setFactoryArmed|markFactorySubmitted)\b/,
  "the read path must not call a control function (autonomous reads never post/arm/mark)",
);
for (const file of ["lib/clipping/research.ts", "lib/clipping/snapshot.ts"]) {
  assert.doesNotMatch(
    read(file),
    /\b(runFactoryTask|setFactoryArmed|markFactorySubmitted)\b/,
    `${file}: an autonomous consumer must not call a factory control function`,
  );
}

// ── 5. The client panel never imports the server-only bridge ────────────────
const panel = read("components/clipping/FactoryPanel.tsx");
assert.doesNotMatch(
  panel,
  /@\/lib\/clipping\/factory-bridge/,
  "the client panel must reach the factory via the API route, not the server-only bridge",
);
assert.match(panel, /\/api\/clipping\/factory/, "the client panel talks to the factory API route");

console.log("clipping factory bridge checks passed");
