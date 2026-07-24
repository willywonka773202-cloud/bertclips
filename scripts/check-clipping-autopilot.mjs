import { readFileSync } from "node:fs";

/**
 * check-clipping-autopilot — invariant guard for the autonomous clip producer.
 *
 * The producer generates + stages clips without a human click, so its safety rails must
 * hold by CODE, not by prompt: it must tick from the 24/7 heartbeat, self-gate on the
 * arm flags + kill switch, use only the FREE local engine (never the paid render lane),
 * and keep auto-posting dormant until a real posting rail is wired. This guard fails the
 * suite the moment any of those invariants regress.
 */

const failures = [];

function read(file) {
  try {
    return readFileSync(file, "utf8");
  } catch {
    failures.push(`${file}: missing`);
    return "";
  }
}

const producer = read("lib/clipping/producer.ts");
const poster = read("lib/clipping/poster.ts");
const discover = read("lib/clipping/discover.ts");
const heartbeat = read("lib/clipping/heartbeat.ts");
const store = read("lib/clipping/store.ts");

// 1. Ticked by the browser-independent heartbeat.
if (!/clipping\/producer/.test(heartbeat) || !/tickClippingProducer/.test(heartbeat)) {
  failures.push("lib/clipping/heartbeat.ts: the clip producer is not wired into the heartbeat (tickClippingProducer)");
}

// 2. The producer self-gates on arm + autoGenerate + kill switch.
for (const flag of ["armed", "autoGenerate", "killSwitch"]) {
  if (!new RegExp(flag).test(producer)) {
    failures.push(`lib/clipping/producer.ts: does not gate on config.${flag}`);
  }
}

// 3. Free-first: the producer must not reach the paid Higgsfield/premium render lane.
if (/higgsfield|premiumRender|premium_render/i.test(producer)) {
  failures.push("lib/clipping/producer.ts: must use the FREE local engine only — no paid render lane");
}

// 4. Auto-post is gated behind a connected rail (isPostingWired) AND config.autoPost.
if (!/isPostingWired/.test(producer) || !/autoPost/.test(producer)) {
  failures.push("lib/clipping/producer.ts: auto-post must be gated on isPostingWired() and config.autoPost");
}

// 5. The posting rail ships DORMANT: no platform connected by default.
if (!/connectedPostingPlatforms/.test(poster)) {
  failures.push("lib/clipping/poster.ts: missing connectedPostingPlatforms()");
} else if (!/connectedPostingPlatforms\(\)\s*:\s*ClipPlatform\[\]\s*\{[\s\S]*?return \[\];/.test(poster)) {
  failures.push("lib/clipping/poster.ts: connectedPostingPlatforms() must return [] by default (posting rail dormant until wired)");
}

// 6. Both autonomy flags default OFF; auto-approve defaults to disabled (0).
if (!/autoGenerate:\s*false/.test(store)) failures.push("lib/clipping/store.ts: DEFAULT_CONFIG.autoGenerate must default to false");
if (!/autoPost:\s*false/.test(store)) failures.push("lib/clipping/store.ts: DEFAULT_CONFIG.autoPost must default to false");
if (!/autoApproveMinScore:\s*0/.test(store)) failures.push("lib/clipping/store.ts: DEFAULT_CONFIG.autoApproveMinScore must default to 0 (auto-approval off)");

// 7. Source auto-discovery is FREE (yt-dlp only) — no paid brain/render in the loop.
if (/runCouncil|askProvider|higgsfield|premiumRender/i.test(discover)) {
  failures.push("lib/clipping/discover.ts: discovery must stay free (yt-dlp metadata only) — no paid brain/render");
}
if (!/runClippingDiscovery/.test(producer)) {
  failures.push("lib/clipping/producer.ts: does not use runClippingDiscovery() to refill an empty queue");
}

if (failures.length) {
  console.error("check-clipping-autopilot FAILED — the autonomous clip producer's rails regressed:");
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}

console.log("check-clipping-autopilot OK — producer is heartbeat-ticked, free-first, arm-gated, and posting stays dormant until wired.");
